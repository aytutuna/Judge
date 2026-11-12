import type { AppLocale } from "../app-strings";

// Modern Standard Arabic, second person singular, as on the web. The example
// cases address the other person, so their verbs follow that person's gender.
const ar: AppLocale = {
  strings: {
    "app.name": "Judge",
    "app.tab.new": "جديد",
    "app.tab.settings": "الإعدادات",
    "app.input.counter": "{count} / {max}",
    "app.history.empty": "لا أحكام بعد. احسم أول خلاف لك وسيظهر حكمه هنا.",
    "app.history.deviceOnly":
      "الأحكام محفوظة على هذا الهاتف فقط. حذف حكم من هنا لا يوقف رابط مشاركته.",
    "app.history.delete": "حذف",
    "app.history.removeAll": "إزالة الكل",
    "app.history.deleteConfirm":
      "هل تريد حذف {n} حكم من هذا الهاتف؟ ستبقى روابط مشاركتها تعمل.",
    "app.history.phoneOnly": "على هذا الهاتف فقط",
    "app.history.phoneOnlyNote":
      "ليست في حسابك: هذه الأحكام محفوظة على هذا الهاتف فقط. حذف حكم منها هنا لا يوقف رابط مشاركته.",
    "app.history.removeConfirm":
      "هل تريد حذف {n} حكم من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وستتوقف روابط مشاركتها عن العمل. لا يمكن التراجع عن ذلك.",
    "app.history.removeLinksConfirm":
      "هل تريد حذف {n} رابط من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وستتوقف الروابط عن العمل. لا يمكن التراجع عن ذلك.",
    "app.history.phoneOnlyAlso":
      "وسيُحذف من هذا الهاتف {n} حكم محفوظ عليه فقط، وستبقى روابط مشاركتها تعمل.",
    "app.history.removeFailed": "تعذّر حذف {n} حكم. تحقّق من اتصالك وحاول مجددًا.",
    "app.history.offlineRemove": "أنت غير متصل بالإنترنت. يحتاج الحذف إلى اتصال.",
    "app.pricing.free.account":
      "سجّل الدخول باستخدام Apple أو Google أو البريد الإلكتروني",
    "app.pricing.context": "صور التوضيح تُقرأ ثم تُحذف، دون أي تكلفة إضافية",
    "app.pricing.headline": "حكمك الأول على حسابنا.",
    "app.pricing.sub":
      "أنشئ حسابًا واحصل على أول حكم مجانًا، بكل المزايا. بعد ذلك، اختر باقة أو اشترك شهريًا.",
    "app.pricing.headlineMember": "احصل على المزيد من الأحكام.",
    "app.pricing.subMember":
      "اختر باقة أو اشترك شهريًا. كل حكم يحصل على هيئة القضاة كاملة.",
    "app.balance.left": "بقي لك {n} حكم",
    "app.balance.monthly": "المتبقي هذا الشهر: {left} من {cap}",
    "app.balance.none": "لم يبقَ لك أي حكم",
    "app.cancel": "إلغاء",
    "app.retry": "إعادة المحاولة",
    "app.error.offline":
      "يبدو أنك غير متصل بالإنترنت. تحقّق من اتصالك وحاول مجددًا.",
    "app.error.timeout": "تأخّر القضاة كثيرًا في الرد. حاول مجددًا بعد دقيقة.",
    "app.error.interrupted":
      "انقطع الاتصال بينما كان Judge يعمل في الخلفية. حاول مجددًا وأبقِ التطبيق مفتوحًا حتى يصل الحكم.",
    "app.turnstile.error":
      "تعذّر تحميل التحقق البشري. تحقّق من اتصالك وحاول مجددًا.",
    "app.factcheck.sourceAria": "{title}، يفتح صفحة الويب",
    "app.error.badOrigin":
      "جاء هذا الطلب من مصدر لا نعرفه. تأكّد من أن التطبيق محدَّث وحاول مجددًا.",
    "app.translate.offline":
      "لا يمكن الترجمة وأنت غير متصل بالإنترنت، فإليك النص الأصلي.",
    "app.share.title": "مشاركة الحكم",
    "app.settings.language": "اللغة",
    "app.settings.languageDevice": "لغة الهاتف",
    "app.settings.appearance": "المظهر",
    "app.settings.usageStats": "إحصاءات الاستخدام",
    "app.settings.usageStatsHint":
      "أعداد للشاشات والميزات المستخدمة، مرتبطة بحسابك عند تسجيل الدخول. لا يُرسَل أي نص من القضايا أبدًا.",
    "app.settings.about": "عن Judge",
    "app.settings.version": "الإصدار {version}",
    "app.signin.required": "سجّل الدخول لتحصل على حكم.",
    "app.signin.link": "سجّل الدخول لترسل له رابطًا.",
    "app.signin.or": "أو",
    "app.signin.codeRequest": "أرسل لي رمز الدخول",
    "app.signin.codeSent":
      "أرسلنا رمزًا إلى {email}. يعمل الرمز لمدة 10 دقائق.",
    "app.signin.codeLabel": "أدخل الرمز المكوّن من 6 أرقام",
    "app.signin.codeSubmit": "تسجيل الدخول",
    "app.signin.codeInvalid":
      "هذا الرمز غير صحيح. تحقّق من الرسالة وحاول مجددًا.",
    "app.signin.codeExpired": "انتهت صلاحية هذا الرمز. اطلب رمزًا جديدًا.",
    "app.signin.codeTooMany":
      "تجاوزت عدد المحاولات المسموح بها لهذا الرمز. اطلب رمزًا جديدًا.",
    "app.signin.codeResend": "إرسال رمز جديد",
    "app.signin.changeEmail": "استخدام بريد إلكتروني آخر",
    "app.signin.rateLimited": "محاولات كثيرة جدًا. انتظر دقيقة وحاول مجددًا.",
    "app.signin.unavailable": "تسجيل الدخول غير متاح الآن. حاول لاحقًا.",
    "app.account.deleteTitle": "هل تريد حذف حسابك؟",
    "app.account.deleteBody":
      "ستُحذف بيانات تسجيل دخولك ورصيدك وخطتك وبياناتك الشخصية، وستتوقف روابط مشاركتك عن العمل. أما نصوص الأحكام فتبقى محفوظة دون اسمك، كما هو موضح في سياسة الخصوصية.",
    "app.account.deleteConfirm": "حذف الحساب",
    "app.account.deleteSubscription":
      "حذف حسابك لا يلغي خطتك الشهرية في المتجر. ستستمر في دفع الرسوم حتى تلغيها هناك.",
    "app.account.manageSubscription": "إدارة الاشتراك",
    "app.account.deleted": "تم حذف حسابك.",
    "app.account.signOutConfirm":
      "هل تريد تسجيل الخروج من Judge على هذا الهاتف؟",
    "app.account.signedOut": "تم تسجيل خروجك.",
    "app.account.sessionExpired":
      "تم تسجيل خروجك. سجّل الدخول مجددًا للمتابعة.",
    "app.close": "إغلاق",
    "app.home.yourSide": "روايتك",
    "app.home.theirSide": "رواية الطرف الآخر",
    "app.home.yourName": "اسمك",
    "app.home.theirName": "اسم الطرف الآخر",
    "app.home.yourPlaceholder": "ما المشكلة؟",
    "app.home.theirPlaceholder":
      "ماذا يقول الطرف الآخر؟ اكتب روايته كما يرويها هو.",
    "app.home.yourSideLabel": "روايتك للخلاف",
    "app.home.theirSideLabel": "رواية الطرف الآخر للخلاف",
    "app.home.sendLink": "أرسل له رابطًا",
    "app.home.addContext": "أضف توضيحًا",
    "app.home.says": "رواية {name}:",
    "app.home.mySide": "روايتي:",
    "app.home.otherSide": "رواية الطرف الآخر:",
    "app.home.example": "جرّب مثالًا",
    "app.home.addTheirSide": "أضف رواية الطرف الآخر",
    "app.home.removeTheirSide": "أزل رواية الطرف الآخر",
    "app.home.clear": "مسح",
    "app.case.waitingKicker": "قضية · بانتظار الرد",
    "app.case.waitingFor": "بانتظار {name}",
    "app.case.waitingLead":
      "تُكتب رواية {name} دون الحاجة إلى إنشاء حساب، ولا يرى أيٌّ منكما كلام الآخر حتى صدور الحكم.",
    "app.case.waitingLeadAnon":
      "يكتب الطرف الآخر روايته دون الحاجة إلى إنشاء حساب، ولا يرى أيٌّ منكما كلام الآخر حتى صدور الحكم.",
    "app.case.sendTo": "أرسل هذا الرابط إلى {name}",
    "app.case.stepYou": "كتبت روايتك",
    "app.case.stepYouNote": "لن تُكشف قبل صدور الحكم",
    "app.case.stepThem": "الدور على {name}",
    "app.case.stepThemAnon": "الطرف الآخر يكتب روايته",
    "app.case.stepThemNote": "تُحدَّث هذه الصفحة حين يصل الرد",
    "app.case.stepJudges": "ثلاثة قضاة يحكمون",
    "app.case.stepJudgesNote": "أو احصل الآن على حكم بروايتك وحدها",
    "app.case.judgeNowWithout": "الحكم الآن دون {name}",
    "app.verdict.vs": "ضد",
    "app.verdict.leanTo": "مالت هيئة القضاة إلى {name}",
    "app.verdict.leanNone": "لم تمل هيئة القضاة إلى أي جانب",
    "app.verdict.sides": "ما يستند إليه كل طرف",
    "app.verdict.claims": "كيف وصل كل طرف إلى رأيه",
    "app.verdict.back": "الحكم",
    "app.appeal.title": "إضافة توضيح والاعتراض على الحكم",
    "app.appeal.placeholder": "ما الذي فات القضاة؟ حقيقة، أو رسالة، أو ما اتفقتما عليه فعلًا.",
    "app.appeal.cost":
      "يستهلك حكمًا واحدًا. يمكنك فعل ذلك مرتين لكل حكم؛ المتبقي: {left}.",
    "app.appeal.costCase":
      "يستهلك حكمًا واحدًا. يمكنك فعل ذلك مرة واحدة لكل قضية.",
    "app.appeal.submit": "إعادة الحكم",
    "app.appeal.upsell":
      "هل ينقص شيء؟ أضف توضيحًا ليُعاد الحكم مقابل حكم واحد.",
    "app.appeal.signIn": "سجّل الدخول لإضافة توضيح والاعتراض على الحكم",
    "app.appeal.used": "سبق أن أضفت توضيحًا إلى هذه القضية.",
    "app.appeal.limit": "أضفت توضيحًا مرتين، وهذا الحد الأقصى للحكم الواحد.",
    "app.purchase.buying": "جارٍ الشراء…",
    "app.purchase.success": "شكرًا! تمت عملية الشراء.",
    "app.purchase.pending":
      "عملية الشراء قيد المعالجة. قد يستغرق ظهورها دقيقة.",
    "app.purchase.arriving": "رصيدك في الطريق…",
    "app.purchase.slow": "قد يستغرق ظهوره هنا دقيقة.",
    "app.purchase.failed": "لم تكتمل عملية الشراء. حاول مجددًا بعد قليل.",
    "app.purchase.restore": "استعادة المشتريات",
    "app.purchase.restoreDone": "تمت استعادة مشترياتك.",
    "app.purchase.restoreNone": "لا توجد مشتريات لاستعادتها.",
    "app.signin.legal": "يقرأ ذكاء اصطناعي خارجي ما تكتبه من خلافات. بالمتابعة، أنت توافق على ",
    "app.signin.legalTerms": "شروط الاستخدام",
    "app.signin.legalAnd": " و",
    "app.signin.legalPrivacy": "سياسة الخصوصية",
    "app.signin.legalAfter": ".",
    "app.legal.terms": "شروط الاستخدام",
    "app.legal.privacy": "سياسة الخصوصية",
    "app.pricing.autoRenew": "تتجدد الخطة الشهرية تلقائيًا كل شهر إلى أن تلغيها من إعدادات الاشتراكات في هاتفك.",
    "app.age.checkbox": "عمري 18 عامًا أو أكثر",
    "app.age.title": "أكّد عمرك",
    "app.age.lead": "Judge للبالغين فقط. أكّد أن عمرك 18 عامًا أو أكثر لتواصل استخدامه.",
    "app.age.continue": "متابعة",
    "app.age.required": "أكّد أن عمرك 18 عامًا أو أكثر للمتابعة.",
    "app.age.blockedTitle": "Judge للبالغين فقط",
    "app.age.blockedBody":
      "يجب أن يكون عمرك 18 عامًا أو أكثر لاستخدام Judge. إذا كنت تعتقد أن هذا خطأ، راسلنا على {email}.",
  },
  plurals: {
    "app.balance.left": {
      zero: "لم يبقَ لك أي حكم",
      one: "بقي لك حكم واحد",
      two: "بقي لك حكمان",
      few: "بقي لك {n} أحكام",
      many: "بقي لك {n} حكمًا",
    },
    "app.history.deleteConfirm": {
      zero: "لا أحكام محددة للحذف.",
      one: "هل تريد حذف هذا الحكم من هذا الهاتف؟ سيبقى رابط مشاركته يعمل.",
      two: "هل تريد حذف حكمين من هذا الهاتف؟ سيبقى رابطا مشاركتهما يعملان.",
      few: "هل تريد حذف {n} أحكام من هذا الهاتف؟ ستبقى روابط مشاركتها تعمل.",
      many: "هل تريد حذف {n} حكمًا من هذا الهاتف؟ ستبقى روابط مشاركتها تعمل.",
    },
    "app.history.removeConfirm": {
      zero: "لا أحكام محددة للحذف.",
      one: "هل تريد حذف هذا الحكم من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وسيتوقف رابط مشاركته عن العمل. لا يمكن التراجع عن ذلك.",
      two: "هل تريد حذف حكمين من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وسيتوقف رابطا مشاركتهما عن العمل. لا يمكن التراجع عن ذلك.",
      few: "هل تريد حذف {n} أحكام من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وستتوقف روابط مشاركتها عن العمل. لا يمكن التراجع عن ذلك.",
      many: "هل تريد حذف {n} حكمًا من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وستتوقف روابط مشاركتها عن العمل. لا يمكن التراجع عن ذلك.",
    },
    "app.history.removeLinksConfirm": {
      zero: "لا روابط محددة للحذف.",
      one: "هل تريد حذف هذا الرابط من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وسيتوقف الرابط عن العمل. لا يمكن التراجع عن ذلك.",
      two: "هل تريد حذف الرابطين من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وسيتوقف الرابطان عن العمل. لا يمكن التراجع عن ذلك.",
      few: "هل تريد حذف {n} روابط من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وستتوقف الروابط عن العمل. لا يمكن التراجع عن ذلك.",
      many: "هل تريد حذف {n} رابطًا من حسابك؟ سيُمحى ما كتبته والأسماء من كل الأجهزة، وستتوقف الروابط عن العمل. لا يمكن التراجع عن ذلك.",
    },
    "app.history.phoneOnlyAlso": {
      zero: "لا أحكام محفوظة على هذا الهاتف فقط.",
      one: "وسيُحذف من هذا الهاتف حكم واحد محفوظ عليه فقط، وسيبقى رابط مشاركته يعمل.",
      two: "وسيُحذف من هذا الهاتف حكمان محفوظان عليه فقط، وسيبقى رابطا مشاركتهما يعملان.",
      few: "وستُحذف من هذا الهاتف {n} أحكام محفوظة عليه فقط، وستبقى روابط مشاركتها تعمل.",
      many: "وسيُحذف من هذا الهاتف {n} حكمًا محفوظًا عليه فقط، وستبقى روابط مشاركتها تعمل.",
    },
    "app.history.removeFailed": {
      zero: "تم حذف كل الأحكام المحددة.",
      one: "تعذّر حذف حكم واحد. تحقّق من اتصالك وحاول مجددًا.",
      two: "تعذّر حذف حكمين. تحقّق من اتصالك وحاول مجددًا.",
      few: "تعذّر حذف {n} أحكام. تحقّق من اتصالك وحاول مجددًا.",
      many: "تعذّر حذف {n} حكمًا. تحقّق من اتصالك وحاول مجددًا.",
    },
  },
};

export default ar;
