import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/** PNG touch icon from app/icon.svg, for browsers (Safari, iOS home screen)
 * that skip SVG favicons. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const svg = await readFile(join(process.cwd(), "app/icon.svg"), "utf8");
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the browser
      <img src={src} width={size.width} height={size.height} alt="" />
    ),
    { ...size },
  );
}
