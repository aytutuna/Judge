import { describe, expect, it } from "vitest";
import { registerLocale } from "../lib/i18n";
import de from "../lib/locales/de";
import ja from "../lib/locales/ja";
import th from "../lib/locales/th";
import zh from "../lib/locales/zh-Hans";
import { conditionalClause } from "../components/VerdictReveal";

registerLocale("de", de);
registerLocale("ja", ja);
registerLocale("th", th);
registerLocale("zh-Hans", zh);

describe("conditionalClause", () => {
  it("drops a repeated prefix in languages written without spaces", () => {
    expect(conditionalClause("もし何より正直さを大切にするなら", "ja")).toBe("何より正直さを大切にするなら");
    expect(conditionalClause("如果你更看重诚实", "zh-Hans")).toBe("你更看重诚实");
    expect(conditionalClause("ถ้าคุณให้ความสำคัญกับความซื่อสัตย์", "th")).toBe("คุณให้ความสำคัญกับความซื่อสัตย์");
  });

  it("drops the prefix only as a whole word elsewhere", () => {
    expect(conditionalClause("Wenn du Ehrlichkeit vorziehst", "de")).toBe("du Ehrlichkeit vorziehst");
    expect(conditionalClause("Wenngleich teuer, zählt Ehrlichkeit", "de")).toBe("Wenngleich teuer, zählt Ehrlichkeit");
  });
});
