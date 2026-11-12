import type { AppLocale } from "../app-strings";

// "તમે" towards the reader, as on the web. The example disputes are people
// talking to each other, so friends and couples use "તું" there.
const gu: AppLocale = {
  strings: {
    "app.name": "Judge",
    "app.tab.new": "નવું",
    "app.tab.settings": "સેટિંગ્સ",
    "app.input.counter": "{count} / {max}",
    "app.history.empty":
      "હજી કોઈ ચુકાદો નથી. તમારા પહેલા વિવાદનો ફેંસલો કરાવો, એ અહીં દેખાશે.",
    "app.history.deviceOnly":
      "ફક્ત આ ફોનમાં સેવ થયેલા છે. અહીંથી કોઈ ચુકાદો ડિલીટ કરવાથી એની શેર લિંક બંધ થતી નથી.",
    "app.history.delete": "ડિલીટ કરો",
    "app.history.removeAll": "બધું દૂર કરો",
    "app.history.deleteConfirm":
      "આ ફોનમાંથી {n} ચુકાદા ડિલીટ કરવા છે? એમની શેર લિંક કામ કરતી રહેશે.",
    "app.history.phoneOnly": "ફક્ત આ ફોનમાં",
    "app.history.phoneOnlyNote":
      "તમારા એકાઉન્ટમાં નથી: આ ફક્ત આ ફોનમાં સેવ થયેલા છે. અહીંથી કોઈ ચુકાદો ડિલીટ કરવાથી એની શેર લિંક બંધ થતી નથી.",
    "app.history.removeConfirm":
      "તમારા એકાઉન્ટમાંથી {n} ચુકાદા દૂર કરવા છે? દરેક ડિવાઇસ પર, તમે લખેલું અને નામ ભૂંસાઈ જશે અને એમની શેર લિંક કામ કરતી બંધ થઈ જશે. આ પાછું વાળી નહીં શકાય.",
    "app.history.phoneOnlyAlso":
      "ફક્ત આ ફોનમાં સેવ થયેલા {n} ચુકાદા ફોનમાંથી ડિલીટ થશે; એમની શેર લિંક કામ કરતી રહેશે.",
    "app.history.removeFailed": "એમાંથી {n} દૂર ન થઈ શક્યા. કનેક્શન તપાસીને ફરી પ્રયાસ કરો.",
    "app.history.offlineRemove": "તમે ઑફલાઇન છો. દૂર કરવા કનેક્શન જોઈએ.",
    "app.pricing.free.account": "Apple, Google કે ઈમેલથી સાઇન ઇન કરો",
    "app.pricing.context": "વિગતની છબીઓ વંચાય છે અને પછી ફેંકી દેવાય છે, કોઈ વધારાનો ખર્ચ નથી",
    "app.pricing.headline": "તમારો પહેલો ચુકાદો અમારા તરફથી.",
    "app.pricing.sub":
      "એકાઉન્ટ બનાવો અને પહેલો ચુકાદો મફત, બધી સુવિધાઓ સાથે. પછી કોઈ પૅક પસંદ કરો કે માસિક પ્લાન લો.",
    "app.pricing.headlineMember": "વધુ ચુકાદા લો.",
    "app.pricing.subMember":
      "કોઈ પૅક પસંદ કરો કે માસિક પ્લાન લો. દરેક ચુકાદામાં જજની આખી પેનલ.",
    "app.balance.left": "{n} ચુકાદા બાકી",
    "app.balance.monthly": "આ મહિને {cap}માંથી {left} બાકી",
    "app.balance.none": "કોઈ ચુકાદો બાકી નથી",
    "app.cancel": "રદ કરો",
    "app.retry": "ફરી પ્રયાસ કરો",
    "app.error.offline":
      "લાગે છે કે તમે ઑફલાઇન છો. કનેક્શન તપાસીને ફરી પ્રયાસ કરો.",
    "app.error.timeout":
      "જજોએ જવાબ આપવામાં બહુ વાર લગાડી. એકાદ મિનિટ પછી ફરી પ્રયાસ કરો.",
    "app.error.interrupted":
      "Judge બૅકગ્રાઉન્ડમાં હતું ત્યારે કનેક્શન તૂટી ગયું. ફરી પ્રયાસ કરો અને ચુકાદો આવે ત્યાં સુધી ઍપ ખુલ્લી રાખો.",
    "app.turnstile.error":
      "તમે માણસ છો કે નહીં એની ચકાસણી લોડ ન થઈ શકી. કનેક્શન તપાસીને ફરી પ્રયાસ કરો.",
    "app.factcheck.sourceAria": "{title}, વેબ પેજ ખોલે છે",
    "app.error.badOrigin":
      "આ વિનંતી કોઈ અજાણી જગ્યાએથી આવી. ઍપ અપડેટ કરેલી છે એની ખાતરી કરીને ફરી પ્રયાસ કરો.",
    "app.translate.offline":
      "ઑફલાઇન હો ત્યારે અનુવાદ ન થઈ શકે, એટલે મૂળ લખાણ બતાવીએ છીએ.",
    "app.share.title": "ચુકાદો શેર કરો",
    "app.settings.language": "ભાષા",
    "app.settings.languageDevice": "ફોનની ભાષા",
    "app.settings.appearance": "દેખાવ",
    "app.settings.usageStats": "વપરાશના આંકડા",
    "app.settings.usageStatsHint":
      "કઈ સ્ક્રીન અને સુવિધાઓ વપરાય છે તેની ગણતરી, સાઇન ઇન હો ત્યારે તમારા એકાઉન્ટ સાથે જોડાયેલી. કેસનું કોઈ લખાણ ક્યારેય મોકલાતું નથી.",
    "app.settings.about": "Judge વિશે",
    "app.settings.version": "વર્ઝન {version}",
    "app.signin.required": "ચુકાદો મેળવવા સાઇન ઇન કરો.",
    "app.signin.link": "લિંક મોકલવા સાઇન ઇન કરો.",
    "app.signin.or": "અથવા",
    "app.signin.codeRequest": "મને કોડ ઈમેલ કરો",
    "app.signin.codeSent":
      "અમે {email} પર કોડ ઈમેલ કર્યો છે. એ 10 મિનિટ ચાલશે.",
    "app.signin.codeLabel": "6 અંકનો કોડ દાખલ કરો",
    "app.signin.codeSubmit": "સાઇન ઇન કરો",
    "app.signin.codeInvalid": "આ કોડ બરાબર નથી. ઈમેલ તપાસીને ફરી પ્રયાસ કરો.",
    "app.signin.codeExpired": "આ કોડની મુદત પૂરી થઈ ગઈ. નવો કોડ માગો.",
    "app.signin.codeTooMany": "આ કોડ માટે ઘણી વાર ખોટો પ્રયાસ થયો. નવો કોડ માગો.",
    "app.signin.codeResend": "નવો કોડ મોકલો",
    "app.signin.changeEmail": "બીજો ઈમેલ વાપરો",
    "app.signin.rateLimited":
      "ઘણા બધા પ્રયાસ થયા. એક મિનિટ રાહ જોઈને ફરી પ્રયાસ કરો.",
    "app.signin.unavailable":
      "અત્યારે સાઇન ઇન ઉપલબ્ધ નથી. પછીથી ફરી પ્રયાસ કરો.",
    "app.account.deleteTitle": "એકાઉન્ટ ડિલીટ કરવું છે?",
    "app.account.deleteBody":
      "તમારી સાઇન ઇનની વિગતો, ક્રેડિટ, પ્લાન અને અંગત ડેટા ડિલીટ થશે, અને તમારી શેર લિંક કામ કરતી બંધ થઈ જશે. ગોપનીયતા નીતિમાં સમજાવ્યા મુજબ, ચુકાદાનું લખાણ તમારા નામ વગર સચવાયેલું રહેશે.",
    "app.account.deleteConfirm": "એકાઉન્ટ ડિલીટ કરો",
    "app.account.deleteSubscription":
      "એકાઉન્ટ કાઢી નાખવાથી સ્ટોરમાં તમારો માસિક પ્લાન રદ થતો નથી. તમે ત્યાં રદ ન કરો ત્યાં સુધી બિલિંગ ચાલુ રહેશે.",
    "app.account.manageSubscription": "સબ્સ્ક્રિપ્શન મેનેજ કરો",
    "app.account.deleted": "તમારું એકાઉન્ટ ડિલીટ થઈ ગયું.",
    "app.account.signOutConfirm": "આ ફોન પર Judgeમાંથી સાઇન આઉટ કરવું છે?",
    "app.account.signedOut": "તમે સાઇન આઉટ થઈ ગયા.",
    "app.account.sessionExpired":
      "તમે સાઇન આઉટ થઈ ગયા છો. આગળ વધવા ફરી સાઇન ઇન કરો.",
    "app.close": "બંધ કરો",
    "app.home.yourSide": "તમારી વાત",
    "app.home.theirSide": "એમની વાત",
    "app.home.yourName": "તમારું નામ",
    "app.home.theirName": "એમનું નામ",
    "app.home.yourPlaceholder": "સમસ્યા શું છે?",
    "app.home.theirPlaceholder": "એ શું કહે છે? એ જે રીતે કહે એ રીતે લખો.",
    "app.home.yourSideLabel": "વિવાદમાં તમારી વાત",
    "app.home.theirSideLabel": "વિવાદમાં એમની વાત",
    "app.home.sendLink": "લિંક મોકલો",
    "app.home.addContext": "વિગત ઉમેરો",
    "app.home.says": "{name} કહે છે:",
    "app.home.mySide": "મારી વાત:",
    "app.home.otherSide": "સામેવાળાની વાત:",
    "app.home.example": "ઉદાહરણ અજમાવો",
    "app.home.addTheirSide": "એમની વાત ઉમેરો",
    "app.home.removeTheirSide": "એમની વાત કાઢી નાખો",
    "app.home.clear": "સાફ કરો",
    "app.case.waitingKicker": "કેસ · જવાબની રાહ",
    "app.case.waitingFor": "{name}ની રાહ જોવાય છે",
    "app.case.waitingLead":
      "{name} એકાઉન્ટ વગર પોતાની વાત લખે છે. ચુકાદો આવે ત્યાં સુધી તમે બંને એકબીજાની વાત નહીં જોઈ શકો.",
    "app.case.waitingLeadAnon":
      "તેઓ એકાઉન્ટ વગર પોતાની વાત લખે છે. ચુકાદો આવે ત્યાં સુધી તમે બંને એકબીજાની વાત નહીં જોઈ શકો.",
    "app.case.sendTo": "{name}ને આ લિંક મોકલો",
    "app.case.stepYou": "તમે તમારી વાત લખી",
    "app.case.stepYouNote": "ચુકાદા સુધી સીલબંધ",
    "app.case.stepThem": "{name} પોતાની વાત લખે છે",
    "app.case.stepThemAnon": "તેઓ પોતાની વાત લખે છે",
    "app.case.stepThemNote": "એમની વાત આવતાં જ આ પેજ અપડેટ થશે",
    "app.case.stepJudges": "ત્રણ જજ ચુકાદો આપે છે",
    "app.case.stepJudgesNote": "અથવા હમણાં ફક્ત તમારી વાત પરથી ચુકાદો મેળવો",
    "app.case.judgeNowWithout": "{name} વગર હમણાં ચુકાદો મેળવો",
    "app.verdict.vs": "વિ.",
    "app.verdict.leanTo": "પેનલ {name}ની તરફ ઝૂકી",
    "app.verdict.leanNone": "પેનલ કોઈ તરફ ન ઝૂકી",
    "app.verdict.sides": "દરેક બાજુ શાના પર ટકેલી છે",
    "app.verdict.claims": "દરેક બાજુ આ તારણ પર કેવી રીતે પહોંચી",
    "app.verdict.back": "ચુકાદો",
    "app.appeal.title": "વિગત ઉમેરો અને અપીલ કરો",
    "app.appeal.placeholder":
      "જજ શું ચૂકી ગયા? કોઈ હકીકત, કોઈ મેસેજ, કે ખરેખર શું નક્કી થયું હતું.",
    "app.appeal.cost":
      "આમાં 1 ચુકાદો વપરાશે. એક ચુકાદામાં આવું બે વાર કરી શકાય; હજી {left} વાર બાકી.",
    "app.appeal.costCase":
      "આમાં 1 ચુકાદો વપરાશે. એક કેસમાં આવું એક જ વાર કરી શકાય.",
    "app.appeal.submit": "ફરી ફેંસલો કરો",
    "app.appeal.upsell":
      "કંઈ ખૂટે છે? વિગત ઉમેરો અને 1 ચુકાદો વાપરીને ફરી ફેંસલો કરાવો.",
    "app.appeal.signIn": "વિગત ઉમેરવા અને અપીલ કરવા સાઇન ઇન કરો",
    "app.appeal.used": "તમે આ કેસમાં પહેલેથી વિગત ઉમેરી દીધી છે.",
    "app.appeal.limit":
      "તમે બે વાર વિગત ઉમેરી છે. એક ચુકાદા માટે આ જ મર્યાદા છે.",
    "app.purchase.buying": "ખરીદી ચાલુ છે…",
    "app.purchase.success": "આભાર! તમારી ખરીદી પૂરી થઈ.",
    "app.purchase.pending":
      "તમારી ખરીદી પ્રોસેસ થઈ રહી છે. દેખાતાં એકાદ મિનિટ લાગી શકે.",
    "app.purchase.arriving": "તમારી ક્રેડિટ આવી રહી છે…",
    "app.purchase.slow": "અહીં દેખાતાં એકાદ મિનિટ લાગી શકે.",
    "app.purchase.failed": "ખરીદી પૂરી ન થઈ. થોડી વારમાં ફરી પ્રયાસ કરો.",
    "app.purchase.restore": "ખરીદી રિસ્ટોર કરો",
    "app.purchase.restoreDone": "તમારી ખરીદી રિસ્ટોર થઈ ગઈ.",
    "app.purchase.restoreNone": "રિસ્ટોર કરવા જેવી કોઈ ખરીદી નથી.",
    "app.signin.legal": "તમારી દલીલો એક બહારની AI સેવા વાંચે છે. આગળ વધીને તમે અમારી ",
    "app.signin.legalTerms": "ઉપયોગની શરતો",
    "app.signin.legalAnd": " અને ",
    "app.signin.legalPrivacy": "ગોપનીયતા નીતિ",
    "app.signin.legalAfter": " સાથે સંમત થાઓ છો.",
    "app.legal.terms": "ઉપયોગની શરતો",
    "app.legal.privacy": "ગોપનીયતા નીતિ",
    "app.pricing.autoRenew":
      "માસિક પ્લાન દર મહિને આપમેળે રિન્યૂ થાય છે, જ્યાં સુધી તમે તેને તમારા ફોનના સબ્સ્ક્રિપ્શન સેટિંગ્સમાંથી રદ ન કરો.",
    "app.age.checkbox": "મારી ઉંમર 18 કે તેથી વધુ છે",
    "app.age.title": "તમારી ઉંમરની પુષ્ટિ કરો",
    "app.age.lead":
      "Judge ફક્ત પુખ્ત વયના લોકો માટે છે. તેનો ઉપયોગ ચાલુ રાખવા પુષ્ટિ કરો કે તમારી ઉંમર 18 કે તેથી વધુ છે.",
    "app.age.continue": "ચાલુ રાખો",
    "app.age.required": "ચાલુ રાખવા પુષ્ટિ કરો કે તમારી ઉંમર 18 કે તેથી વધુ છે.",
    "app.age.blockedTitle": "Judge ફક્ત પુખ્ત વયના લોકો માટે છે",
    "app.age.blockedBody":
      "Judge વાપરવા માટે તમારી ઉંમર 18 કે તેથી વધુ હોવી જોઈએ. જો તમને લાગે કે આ ભૂલ છે, તો અમને {email} પર લખો.",
  },
  plurals: {
    "app.balance.left": { one: "{n} ચુકાદો બાકી" },
    "app.history.deleteConfirm": {
      one: "આ ફોનમાંથી {n} ચુકાદો ડિલીટ કરવો છે? એની શેર લિંક કામ કરતી રહેશે.",
    },
    "app.history.removeConfirm": {
      one: "તમારા એકાઉન્ટમાંથી {n} ચુકાદો દૂર કરવો છે? દરેક ડિવાઇસ પર, તમે લખેલું અને નામ ભૂંસાઈ જશે અને એની શેર લિંક કામ કરતી બંધ થઈ જશે. આ પાછું વાળી નહીં શકાય.",
    },
    "app.history.phoneOnlyAlso": {
      one: "ફક્ત આ ફોનમાં સેવ થયેલો {n} ચુકાદો ફોનમાંથી ડિલીટ થશે; એની શેર લિંક કામ કરતી રહેશે.",
    },
    "app.history.removeFailed": {
      one: "{n} ચુકાદો દૂર ન થઈ શક્યો. કનેક્શન તપાસીને ફરી પ્રયાસ કરો.",
    },
  },
};

export default gu;
