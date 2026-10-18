import { ImageResponse } from "next/og";
import { OG_SIZE, OgCard } from "@/components/OgCard";

export const alt = "Verdict: who's right? Settle it.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <OgCard
        eyebrow="Three independent AI judges"
        title="Who's right? Settle it."
        subtitle="Describe the argument. Get the crux, a ruling and an honest confidence score."
        footer="Steelman · Crux · Three judges · Cross-examination"
        tugA={50}
      />
    ),
    { ...size },
  );
}
