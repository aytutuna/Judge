import { t, type Lang } from "@/lib/i18n";
import type { VerdictResult } from "@/lib/types";
import { noOrphan } from "@/lib/text";
import { VerdictCard } from "../verdict/VerdictCard";
import { VerdictDetails } from "../verdict/VerdictDetails";
import cardStyles from "../verdict/verdict.module.css";
import styles from "./SampleVerdict.module.css";

/** The hot dog case: Party B ("You") wins 3–0, confidence 3 of 3. The 3D
 * story's verdict step uses the same tugA, so the scene and the card agree.
 * "You" is the reader, so the card and the story both draw Party B as their
 * own side. */
export const SAMPLE_TUG_A = 20;

/** "What a verdict looks like": a clearly badged, static example in the same
 * card as the real verdict, with the rows that open its details. */
export function SampleVerdict({ lang }: { lang: Lang }) {
  const nameA = t(lang, "sample.nameA");
  const nameB = t(lang, "sample.nameB");
  const result: VerdictResult = {
    verdict: "side_b",
    dispute_type: "definitional",
    headline: t(lang, "sample.headline"),
    why: t(lang, "sample.why"),
    crux: t(lang, "sample.crux"),
    split_points: null,
    conditional: null,
    argument_map: { side_a: [], side_b: [], bedrock_a: "", bedrock_b: "" },
    facts_relied_on: [],
    losing_side_best_point: t(lang, "sample.bestPoint"),
    confidence: 5,
    runs: ["side_b", "side_b", "side_b"],
    demo: false,
    lang,
  };

  return (
    <section id="sample" aria-labelledby="sample-title" className={styles.sample}>
      <div className={`wrap ${styles.grid}`}>
        <div className={styles.copy}>
          <p className="kicker">{t(lang, "sample.kicker")}</p>
          <h2 id="sample-title" className={styles.title}>
            {noOrphan(t(lang, "sample.title"))}
          </h2>
          <p className={styles.lead}>{t(lang, "sample.lead")}</p>
        </div>

        <div className={`${styles.cardWrap} flex flex-col gap-3`} data-you="b">
          <VerdictCard
            result={result}
            nameA={nameA}
            nameB={nameB}
            aIsSelf={false}
            bIsSelf
            lang={lang}
            you="b"
            headingAs="h3"
            top={<span className={cardStyles.pill}>{t(lang, "sample.badge")}</span>}
          />
          <VerdictDetails
            result={result}
            parties={{ nameA, nameB, aIsSelf: false, bIsSelf: true }}
            lang={lang}
          />
        </div>
      </div>
    </section>
  );
}
