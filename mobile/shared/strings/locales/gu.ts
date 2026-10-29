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
    "app.history.select": "પસંદ કરો",
    "app.history.selectAll": "બધા પસંદ કરો",
    "app.history.deselectAll": "પસંદગી હટાવો",
    "app.history.selected": "{n} પસંદ કરેલ",
    "app.history.deleteCount": "ડિલીટ કરો ({count})",
    "app.history.deleteConfirm":
      "આ ફોનમાંથી {n} ચુકાદા ડિલીટ કરવા છે? એમની શેર લિંક કામ કરતી રહેશે.",
    "app.history.rowSelected": "પસંદ કરેલ",
    "app.history.rowNotSelected": "પસંદ કરેલ નથી",
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
    "app.settings.appearanceSystem": "ફોન પ્રમાણે",
    "app.settings.appearanceLight": "લાઇટ",
    "app.settings.appearanceDark": "ડાર્ક",
    "app.settings.about": "Judge વિશે",
    "app.settings.version": "વર્ઝન {version}",
    "app.signin.required": "ચુકાદો મેળવવા સાઇન ઇન કરો.",
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
    "app.account.deleted": "તમારું એકાઉન્ટ ડિલીટ થઈ ગયું.",
    "app.account.signOutConfirm": "આ ફોન પર Judgeમાંથી સાઇન આઉટ કરવું છે?",
    "app.account.signedOut": "તમે સાઇન આઉટ થઈ ગયા.",
    "app.account.sessionExpired":
      "તમે સાઇન આઉટ થઈ ગયા છો. આગળ વધવા ફરી સાઇન ઇન કરો.",
    "app.close": "બંધ કરો",
    "app.home.lead":
      "બંને બાજુની વાત લખો, અથવા સામેની વ્યક્તિને લિંક મોકલો, જેથી એ પોતાની વાત જાતે લખે.",
    "app.home.leadSolo": "તમારી વાત લખો, અને ખબર હોય તો એમની પણ.",
    "app.home.yourSide": "તમારી વાત",
    "app.home.theirSide": "એમની વાત",
    "app.home.yourName": "તમારું નામ",
    "app.home.theirName": "એમનું નામ",
    "app.home.yourPlaceholder": "તમારી નજરે શું થયું?",
    "app.home.theirPlaceholder": "એ શું કહે છે? એ જે રીતે કહે એ રીતે લખો.",
    "app.home.yourSideLabel": "વિવાદમાં તમારી વાત",
    "app.home.theirSideLabel": "વિવાદમાં એમની વાત",
    "app.home.sendLink": "અથવા એમને લિંક મોકલો, જેથી એ જાતે લખે",
    "app.home.says": "{name} કહે છે:",
    "app.home.mySide": "મારી વાત:",
    "app.home.otherSide": "સામેવાળાની વાત:",
    "app.home.example": "ઉદાહરણ અજમાવો",
    "app.example.dishwasher.aName": "ધ્વનિ",
    "app.example.dishwasher.a":
      "તેં ફરી વાટકા ઉપરના રૅકમાં મૂક્યા. ત્યાં એ ક્યારેય ચોખ્ખા નથી નીકળતા, નીચેનું રૅક એના માટે જ તો છે.",
    "app.example.dishwasher.bName": "પાર્થ",
    "app.example.dishwasher.b":
      "ઉપર એ આરામથી સમાઈ જાય છે, અને નીચે તપેલાં માટે જગ્યા રહે છે. હું વર્ષોથી આમ જ ગોઠવું છું, ને કદી કંઈ ગંદું નથી નીકળ્યું.",
    "app.example.bill.aName": "પ્રિયા",
    "app.example.bill.a":
      "મેં કંઈ પીધું જ નથી, તો ડ્રિંક્સના બિલનો ચોથો ભાગ હું શું કામ ભરું? જમવાનું સરખે ભાગે વહેંચીએ, એમાં મને વાંધો નથી.",
    "app.example.bill.bName": "જય",
    "app.example.bill.b":
      "આપણે તો હંમેશાં ચાર સરખા ભાગ જ કરીએ છીએ. દર વખતે કોણે શું લીધું એનો હિસાબ કરવો માથાકૂટ છે, અને ફરક પણ કંઈ ખાસ નથી.",
    "app.example.thermostat.aName": "નેહા",
    "app.example.thermostat.a":
      "AC 18 ડિગ્રી પર છે અને હૂડી પહેરીને પણ મને ઠંડી લાગે છે. 24 કરવામાં કંઈ ખોટું નથી.",
    "app.example.thermostat.bName": "કુણાલ",
    "app.example.thermostat.b":
      "24માં તો ગરમીથી ઊંઘ જ ન આવે. તું એક ચાદર વધારે ઓઢી લે, મારી પાસે તો હવે ઉતારવા જેવું કંઈ બચ્યું નથી.",
    "app.example.roadTrip.aName": "રોહન",
    "app.example.roadTrip.a":
      "જતી વખતે આખા છ કલાક મેં ગાડી ચલાવી. વળતાં તું ચલાવે એ જ વાજબી છે.",
    "app.example.roadTrip.bName": "ચિરાગ",
    "app.example.roadTrip.b":
      "નીકળતાં પહેલાં જ મેં કહ્યું હતું કે મને રાતે ગાડી ચલાવવી જરાય નથી ગમતી, અને આપણે સાંજે 7 વાગ્યે નીકળીએ છીએ. આવતી ટ્રિપમાં સવારનું ડ્રાઇવિંગ હું કરીશ.",
    "app.example.seat.aName": "અમી",
    "app.example.seat.a":
      "મારી સીટ પાછળ નમે છે, તો હું નમાવું છું. રાતની ફ્લાઇટ છે અને બધા સૂવાનો પ્રયાસ કરે છે.",
    "app.example.seat.bName": "હાર્દિક",
    "app.example.seat.b":
      "મારી હાઇટ 6 ફૂટ 3 ઇંચ છે, અને મારા ઘૂંટણ પહેલેથી તમારી સીટમાં દબાય છે. છેક પાછળ નમાવતાં પહેલાં ઓછામાં ઓછું પૂછી તો શકો.",
    "app.example.spoiler.aName": "ખુશી",
    "app.example.spoiler.a":
      "મેં છેલ્લો એપિસોડ શરૂ પણ નહોતો કર્યો ને તેં કહી દીધું કે ખૂની કોણ છે. આખું અઠવાડિયું હું એની રાહ જોતી હતી.",
    "app.example.spoiler.bName": "મીત",
    "app.example.spoiler.b":
      "એ સિરીઝ ત્રણ અઠવાડિયાં પહેલાં આવી ગઈ હતી, અને તેં જ કહ્યું હતું કે તેં જોઈ લીધી છે. કોણ કયા એપિસોડ પર છે એનો હિસાબ હું ન રાખી શકું.",
    "app.example.jacket.aName": "નિધિ",
    "app.example.jacket.a":
      "તું મને પૂછ્યા વગર મારું ડેનિમ જૅકેટ પહેરીને કૉન્સર્ટમાં ગયો. પાછું આવ્યું ત્યારે એમાંથી ધુમાડાની વાસ આવતી હતી.",
    "app.example.jacket.bName": "સાગર",
    "app.example.jacket.b":
      "એ દરવાજા પાસે લટકતું હતું, અને તું તો એ ક્યારેય પહેરતી નથી. હું પૂછી લેત, પણ તું સૂતી હતી અને મને પહેલેથી મોડું થઈ ગયું હતું.",
    "app.example.lastSlice.aName": "યશ",
    "app.example.lastSlice.a":
      "ફિલ્મ શરૂ થઈ એ પહેલાં જ મેં કહી દીધું હતું કે પિઝાનો છેલ્લો પીસ મારો. બધાએ સાંભળ્યું હતું.",
    "app.example.lastSlice.bName": "પૂજા",
    "app.example.lastSlice.b":
      "“મારો” કહીને બે કલાક સુધી હાથ પણ ન લગાડાય. એ ત્યાં પડ્યો પડ્યો ઠંડો થતો હતો, એટલે મેં ખાઈ લીધો.",
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
    "app.appeal.intro":
      "જજ કંઈ ચૂકી ગયા? એ ઉમેરો અને તેઓ ફરી ફેંસલો કરશે. પહેલો ચુકાદો રેકૉર્ડમાં રહે છે.",
    "app.appeal.ask": "જજોને શું ખબર હોવી જોઈએ?",
    "app.appeal.placeholder":
      "કોઈ હકીકત, કોઈ મેસેજ, કે ખરેખર શું નક્કી થયું હતું.",
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
  },
  plurals: {
    "app.balance.left": { one: "{n} ચુકાદો બાકી" },
    "app.history.selected": { one: "{n} પસંદ કરેલ" },
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
