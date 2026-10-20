import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard, ogFonts } from "@/components/OgCard";
import { t } from "@/lib/i18n";

export const alt = "Settle: who's right?";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Three independent AI judges"
        title={t("en", "hero.titleLine1")}
        titleSerif={t("en", "hero.titleLine2")}
        subtitle="Describe the argument. Get the crux, a ruling and an honest confidence score."
        footer="Steelman · Crux · Three judges · Cross-examination"
        tugA={50}
      />
    ),
    { ...size, fonts: await ogFonts() },
  );
}
