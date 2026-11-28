import Foundation

/// The ISO 3166-1 country list of the date step (the same codes as the
/// website's lib/countries.ts) and the store's three-letter codes.
enum Countries {
    /// Alpha-2 codes.
    static let codes: [String] = twoLetter.split(separator: " ").map(String.init)

    /// "GBR" to "GB", the way StoreKit names a storefront and the server
    /// takes a country. nil for a code not in the list.
    static func alpha2(fromAlpha3 code: String) -> String? {
        alpha3[code.uppercased()]
    }

    /// Names in the app's language, sorted the way that language sorts.
    static func options(lang: AppLang) -> [Option] {
        codes
            .map { Option(code: $0, name: lang.locale.localizedString(forRegionCode: $0) ?? $0) }
            .sorted { $0.name.compare($1.name, locale: lang.locale) == .orderedAscending }
    }

    struct Option: Identifiable {
        var code: String
        var name: String
        var id: String { code }
    }

    private static let alpha3: [String: String] = {
        Dictionary(uniqueKeysWithValues: zip(threeLetter.split(separator: " ").map(String.init), codes))
    }()

    private static let twoLetter =
        "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
        "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS " +
        "BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN " +
        "CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE " +
        "EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF " +
        "GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
        "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM " +
        "JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC " +
        "LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK " +
        "ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA " +
        "NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG " +
        "PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
        "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS " +
        "ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO " +
        "TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
        "VN VU WF WS XK YE YT ZA ZM ZW"

    private static let threeLetter =
        "AND ARE AFG ATG AIA ALB ARM AGO ATA ARG ASM AUT AUS ABW ALA AZE " +
        "BIH BRB BGD BEL BFA BGR BHR BDI BEN BLM BMU BRN BOL BES BRA BHS " +
        "BTN BVT BWA BLR BLZ CAN CCK COD CAF COG CHE CIV COK CHL CMR CHN " +
        "COL CRI CUB CPV CUW CXR CYP CZE DEU DJI DNK DMA DOM DZA ECU EST " +
        "EGY ESH ERI ESP ETH FIN FJI FLK FSM FRO FRA GAB GBR GRD GEO GUF " +
        "GGY GHA GIB GRL GMB GIN GLP GNQ GRC SGS GTM GUM GNB GUY HKG HMD " +
        "HND HRV HTI HUN IDN IRL ISR IMN IND IOT IRQ IRN ISL ITA JEY JAM " +
        "JOR JPN KEN KGZ KHM KIR COM KNA PRK KOR KWT CYM KAZ LAO LBN LCA " +
        "LIE LKA LBR LSO LTU LUX LVA LBY MAR MCO MDA MNE MAF MDG MHL MKD " +
        "MLI MMR MNG MAC MNP MTQ MRT MSR MLT MUS MDV MWI MEX MYS MOZ NAM " +
        "NCL NER NFK NGA NIC NLD NOR NPL NRU NIU NZL OMN PAN PER PYF PNG " +
        "PHL PAK POL SPM PCN PRI PSE PRT PLW PRY QAT REU ROU SRB RUS RWA " +
        "SAU SLB SYC SDN SWE SGP SHN SVN SJM SVK SLE SMR SEN SOM SUR SSD " +
        "STP SLV SXM SYR SWZ TCA TCD ATF TGO THA TJK TKL TLS TKM TUN TON " +
        "TUR TTO TUV TWN TZA UKR UGA UMI USA URY UZB VAT VCT VEN VGB VIR " +
        "VNM VUT WLF WSM XKS YEM MYT ZAF ZMB ZWE"
}
